/* 登录页 */
import React, { Component } from 'react';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { Link, withRouter } from 'react-router-dom';
import { createSelector, createStructuredSelector } from 'reselect';
import { Spin, message, Select } from 'antd';
import style from './style.sass';
import SmartQQ from '../../../components/smartQQ/SmartQQ';
import option from '../../publicMethod/option';
import { changeQQLoginList, cursorOption, kd48LiveListenerTimer, getLoginInformation } from '../store/reducer';
import callback from '../../../components/callback/index';
import Detail from './Detail';
import getModianInformation from '../../../components/modian/getModianInformation';
import { str2reg } from '../../../function';
import kd48timer, { init } from '../../../components/kd48listerer/timer';
import ModianWorker from 'worker-loader?name=script/modian_[hash]_worker.js!../../../components/modian/modian.worker';
import WeiBoWorker from 'worker-loader?name=script/weibo_[hash]_worker.js!../../../components/weibo/weibo.worker';
import { requestRoomMessage } from '../../../components/kd48listerer/roomListener';
const fs: Object = global.require('fs');
const schedule: Object = global.require('node-schedule');

let qq: ?SmartQQ = null;
let timer: ?number = null;

/**
 * 写入文件
 * @param { string } file: 文件地址
 * @param { Buffer } data: 图片二进制流
 * @return { Promise }
 */
function writeImage(file: string, data: Buffer): Promise{
  return new Promise((resolve: Function, reject: Function): void=>{
    fs.writeFile(file, data, {
      flags: 'w+'
    }, (err: any): void=>{
      if(err){
        reject();
      }else{
        resolve();
      }
    });
  });
}

/* 初始化数据 */
const getState: Function = ($$state: Immutable.Map): ?Immutable.Map => $$state.has('login') ? $$state.get('login') : null;

const state: Function = createStructuredSelector({
  qqLoginList: createSelector(             // QQ登录列表
    getState,
    ($$data: ?Immutable.Map): Array=>{
      const qqLoginList: Immutable.List | Array = $$data !== null ? $$data.get('qqLoginList') : [];
      return qqLoginList instanceof Array ? qqLoginList : qqLoginList.toJS();
    }
  ),
  optionList: createSelector(              // QQ配置列表
    getState,
    ($$data: ?Immutable.Map): Array=>{
      const optionList: Immutable.List | Array = $$data !== null ? $$data.get('optionList') : [];
      return optionList instanceof Array ? optionList : optionList.toJS();
    }
  ),
  kd48LiveListenerTimer: createSelector(   // 口袋直播
    getState,
    ($$data: ?Immutable.Map): ?number => $$data !== null ? $$data.get('kd48LiveListenerTimer') : null
  )
});

/* dispatch */
const dispatch: Function = (dispatch: Function): Object=>({
  action: bindActionCreators({
    changeQQLoginList,
    cursorOption,
    kd48LiveListenerTimer,
    getLoginInformation
  }, dispatch)
});

@withRouter
@connect(state, dispatch)
class Login extends Component{
  state: {
    imgUrl: ?string,
    loginState: number,
    qq: ?SmartQQ,
    timer: ?number,
    optionItemIndex: ?number
  };

  constructor(): void{
    super(...arguments);

    this.state = {
      imgUrl: null,    // 图片地址
      loginState: 0,   // 登录状态，0：加载二维码，1：二维码加载完毕，2：登陆中
      qq: null,
      timer: null,
      optionItemIndex: null // 当前选择的配置索引
    };
  }
  UNSAFEcomponentWillMount(): void{
    this.props.action.cursorOption({
      query: {
        indexName: 'time'
      }
    });
  }
  // 登录成功事件
  loginSuccess(): void{
    if(qq){
      qq.loginSuccess(async(): Promise<void>=>{
        try{
          const basic: Object = qq.option.basic;
          // 获取微打赏相关信息
          if(basic.isModian){
            const { title, goal }: {
              title: string,
              goal: string
            } = await getModianInformation(basic.modianId);
            qq.modianTitle = title;
            qq.modianGoal = goal;
            // 创建新的摩点webWorker
            qq.modianWorker = new ModianWorker();
            qq.modianWorker.postMessage({
              type: 'init',
              modianId: basic.modianId,
              title,
              goal
            });
            qq.modianWorker.addEventListener('message', qq.listenModianWorkerCbInformation.bind(qq), false);
          }
          // 口袋48直播监听
          if(basic.is48LiveListener){
            const memberReg: RegExp = str2reg(basic.kd48LiveListenerMembers);
            qq.members = memberReg;
            // 开启口袋48监听
            await init();
            if(this.props.kd48LiveListenerTimer === null){
              this.props.action.kd48LiveListenerTimer({
                timer: global.setInterval(kd48timer, 15000)
              });
            }
          }
          // 房间信息监听
          if(basic.isRoomListener){
            // 数据库读取token
            const res: Object = await this.props.action.getLoginInformation({
              query: 'loginInformation'
            });
            if(res.result !== undefined){
              qq.kouDai48Token = res.result.value.token;
              const req: Object = await requestRoomMessage(basic.roomId, qq.kouDai48Token);
              qq.roomLastTime = req.content.data[0].msgTime;
              qq.roomListenerTimer = global.setTimeout(qq.listenRoomMessage.bind(qq), 15000);
            }
          }
          // 微博监听
          if(basic.isWeiboListener){
            qq.weiboWorker = new WeiBoWorker();
            qq.weiboWorker.postMessage({
              type: 'init',
              containerid: basic.lfid
            });
            qq.weiboWorker.addEventListener('message', qq.listenWeiboWorkerCbInformation.bind(qq), false);
          }
          // 群内定时消息推送
          if(basic.isTimingMessagePush){
            qq.timingMessagePushTimer = schedule.scheduleJob(
              basic.timingMessagePushFormat,
              qq.timingMessagePush.bind(qq, basic.timingMessagePushText)
            );
          }
          // 监听信息
          const t2: number = global.setInterval(qq.listenMessage.bind(qq), 1000);  // 轮询
          qq.listenMessageTimer = t2;
          // 将新的qq实例存入到store中
          const ll: Array = this.props.qqLoginList;
          ll.push(qq);
          this.props.action.changeQQLoginList({
            qqLoginList: ll
          });
          qq = null;
          this.props.history.push('/Login');
        }catch(err){
          console.error('登录错误', err);
          message.error('登录失败！');
        }
      });
    }
  }
  // 判断是否登陆
  async isLogin(): Promise<void>{
    try{
      // 轮询判断是否登陆
      const [x, cookies2]: [string, Object] = await qq.isLogin();
      const status: string[] = x.split(/[()',]/g); // 2：登陆状态，17：姓名，8：登录地址
      if(status[2] === '65'){
        // 失效，重新获取二维码
        const [dataReset, cookiesReset]: [Buffer, Object] = await qq.downloadPtqr();
        qq.cookie = cookiesReset;
        await writeImage(option.ptqr, dataReset);
        qq.getToken();
        this.setState({
          imgUrl: option.ptqr
        });
      }else if(status[2] === '0'){
        // 登陆成功
        global.clearInterval(timer);
        timer = null;
        this.setState({
          imgUrl: option.ptqr,
          loginState: 2
        });
        qq.url = status[8];                               // 登录url
        qq.name = status[17];                             // qq昵称
        qq.cookie = Object.assign(qq.cookie, cookies2);
        qq.ptwebqq = qq.cookie.ptwebqq;
        // 获取配置项
        qq.option = this.props.optionList[Number(this.state.optionItemIndex)];
        this.loginSuccess();
      }
    }catch(err){
      console.error('登录错误', err);
      message.error('初始化失败！');
    }
  }
  async componentDidMount(): Promise<void>{
    // 初始化QQ
    try{
      qq = new SmartQQ({
        callback
      });
      const ptqr: [Buffer, Object] = await qq.downloadPtqr();
      const data: Buffer = ptqr[0];
      const cookies: Object = ptqr[1];
      qq.cookie = cookies;
      // 写入图片
      await writeImage(option.ptqr, data);
      // 计算令牌
      qq.getToken();
      timer = global.setInterval(this.isLogin.bind(this), 500);
      this.setState({
        imgUrl: option.ptqr,
        loginState: 1
      });
    }catch(err){
      console.error('登录错误', err);
      message.error('初始化失败！');
    }
  }
  componentWillUnmount(): void{
    if(timer) global.clearInterval(timer); // 清除定时器
    // 清除qq相关
    if(qq !== null){
      qq.outAndClear();
      // 判断是否需要关闭直播监听
      if(this.props.kd48LiveListenerTimer !== null){
        let isListener: boolean = false;
        for(let i: number = 0, j: number = this.props.qqLoginList.length; i < j; i++){
          const item: SmartQQ = this.props.qqLoginList[i];
          if(item.option.basic.is48LiveListener && item.members){
            isListener = true;
            break;
          }
        }
        if(isListener === false){
          global.clearInterval(this.props.kd48LiveListenerTimer);
          this.props.action.kd48LiveListenerTimer({
            timer: null
          });
        }
      }

      qq = null;
    }
  }
  ptqrBody(timeString: number): Object | Array{
    switch(this.state.loginState){
      case 0:
        return (
          <Spin className={ style.ptqr } tip="正在加载二维码..." />
        );
      case 1:
        return [
          <img key={ 0 } className={ style.ptqr } src={ this.state.imgUrl + '?t=' + timeString } alt="登录二维码" title="登录二维码" />,
          this.state.optionItemIndex === null ? (
            <p key={ 1 } className={ style.noOption }>必须先选择一个配置项</p>
          ) : null
        ];
      case 2:
        return (
          <Spin className={ style.ptqr } tip="登陆中...">
            <img className={ `${ style.ptqr } ${ style.o }` } src={ this.state.imgUrl + '?t=' + timeString } alt="登录二维码" title="登录二维码" />
          </Spin>
        );
    }
  }
  // select
  selectOption(): Array{
    return this.props.optionList.map((item: Object, index: number): void=>{
      const index1: string = `${ index }`;
      return (
        <Select.Option key={ index1 } value={ index1 }>
          { item.name }
        </Select.Option>
      );
    });
  }
  onOptionSelect(value: number, option: any): void{
    this.setState({
      optionItemIndex: value
    });
  }
  render(): Object{
    const index: ?number = this.state.optionItemIndex ? Number(this.state.optionItemIndex) : null;
    return (
      <div className={ style.body }>
        <div className={ style.ptqrBody }>
          { this.ptqrBody(new Date().getTime()) }
        </div>
        <p className={ style.tishi }>
          请用手机QQ扫描登录，或者
          <Link to="/Login">返回</Link>
        </p>
        <div className={ style.changeOption }>
          <label>选择一个配置文件：</label>
          <Select className={ style.select }
            dropdownClassName={ style.select }
            value={ this.state.optionItemIndex }
            onSelect={ this.onOptionSelect.bind(this) }
          >
            { this.selectOption() }
          </Select>
        </div>
        <article className={ style.tixing }>
          <p>如果出现无法登陆的情况，请先检查：</p>
          <p>1、摩点的配置是否正确；</p>
          <p>2、口袋48账号是否登录；</p>
          <p>3、口袋48账号token是否过期（token有效时间一个月）；</p>
          <p>4、其他配置是否正确。</p>
        </article>
        <Detail detail={ index === null ? null : this.props.optionList[index] } />
      </div>
    );
  }
}

export default Login;